using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The platform admin's billing operations (ADR 0028). Every endpoint reaching this is behind the
/// platform-admin policy. An operation on one workspace sets that workspace as the request's tenant
/// context first, so its writes pass the ordinary tenant write guard.
/// </summary>
internal sealed class PlatformBillingAdminService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    IMutableTenantContext tenantContext,
    IOptions<PlatformBillingOptions> options)
    : IPlatformBillingAdminService
{
    public async Task<IReadOnlyList<AdminWorkspaceSummary>> ListWorkspacesAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var plans = await PlatformBillingReader.PlansAsync(dbContext, cancellationToken);
        var summaries = new List<AdminWorkspaceSummary>();
        foreach (var workspace in await PlatformBillingReader.WorkspacesAsync(dbContext, null, cancellationToken))
        {
            var state = await PlatformBillingReader.StateAsync(dbContext, workspace, plans, now, cancellationToken);
            summaries.Add(Summary(state, now));
        }

        return summaries;
    }

    public async Task<AdminWorkspaceDetail?> GetWorkspaceAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantId, cancellationToken)).SingleOrDefault();
        if (workspace is null)
        {
            return null;
        }

        var now = clock.UtcNow;
        var plans = await PlatformBillingReader.PlansAsync(dbContext, cancellationToken);
        var state = await PlatformBillingReader.StateAsync(dbContext, workspace, plans, now, cancellationToken);
        var today = PaymentSchedule.Today(now);
        return new AdminWorkspaceDetail(
            Summary(state, now),
            state.CurrentMonth,
            state.Invoices.Select(item => PlatformBillingReader.ToView(item, today, forAdmin: true)).ToList(),
            state.Discounts.OrderByDescending(item => item.StartsOn).Select(PlatformBillingReader.ToView).ToList());
    }

    public async Task<IReadOnlyList<PricePlanView>> ListPricePlansAsync(CancellationToken cancellationToken)
    {
        var plans = await PlatformBillingReader.PlansAsync(dbContext, cancellationToken);
        var current = plans.Count == 0 ? 0 : plans.Max(plan => plan.VersionNumber);
        return plans
            .OrderByDescending(plan => plan.VersionNumber)
            .Select(plan => ToView(plan, plan.VersionNumber == current))
            .ToList();
    }

    public async Task<BillingCommandResult<PricePlanView>> PublishPricePlanAsync(
        PublishPricePlanRequest request,
        CancellationToken cancellationToken)
    {
        var terms = new PricePlanTerms(
            PricePlanTerms.BillingCurrency,
            request.SeatPrice,
            request.IncludedClientsPerSeat,
            request.ExtraClientPrice,
            request.GymFee,
            request.GymFeeMinimumSeats,
            request.TrialDays,
            request.PaymentTermDays,
            request.GraceDays);
        var errors = terms.Validate().ToDictionary();
        if (request.Note is { Length: > 500 })
        {
            errors[nameof(request.Note)] = ["Keep the note to 500 characters."];
        }

        if (errors.Count > 0)
        {
            return BillingCommand.Invalid<PricePlanView>(errors);
        }

        var current = await dbContext.PlatformPricePlans.MaxAsync(plan => (int?)plan.VersionNumber, cancellationToken) ?? 0;
        if (current != request.ExpectedCurrentVersion)
        {
            return PlanChanged();
        }

        var plan = PlatformPricePlan.Publish(current + 1, terms, request.Note, currentUser.UserId, clock.UtcNow);
        dbContext.PlatformPricePlans.Add(plan);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsViolation(exception, PostgresErrorCodes.UniqueViolation))
        {
            return PlanChanged();
        }

        return BillingCommand.Success<PricePlanView>(ToView(plan, isCurrent: true));
    }

    public async Task<BillingCommandResult<PlatformPaymentView>> RecordPaymentAsync(
        Guid invoiceId,
        RecordPlatformPaymentRequest request,
        CancellationToken cancellationToken)
    {
        var reference = request.Reference?.Trim() ?? string.Empty;
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (reference.Length is 0 or > 100)
        {
            return BillingCommand.Invalid<PlatformPaymentView>(
                nameof(request.Reference),
                "Enter the Whish or transfer reference, up to 100 characters.");
        }

        if (note is { Length: > 500 })
        {
            return BillingCommand.Invalid<PlatformPaymentView>(nameof(request.Note), "Keep the note to 500 characters.");
        }

        if (!await EnterInvoiceWorkspaceAsync(invoiceId, cancellationToken))
        {
            return BillingCommand.NotFound<PlatformPaymentView>();
        }

        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            // Serializes a payment against a void of the same invoice.
            await PlatformBillingReader.LockInvoiceAsync(dbContext, invoiceId, cancellationToken);
            var invoice = await dbContext.PlatformInvoices.AsNoTracking().SingleAsync(item => item.Id == invoiceId, cancellationToken);
            if (await dbContext.PlatformInvoiceVoids.AnyAsync(item => item.InvoiceId == invoiceId, cancellationToken))
            {
                return BillingCommand.Conflict<PlatformPaymentView>(
                    "invoice_void",
                    "This invoice was voided. Record the payment against its replacement.");
            }

            var existing = await dbContext.PlatformPayments.AsNoTracking()
                .SingleOrDefaultAsync(item => item.InvoiceId == invoiceId, cancellationToken);
            if (existing is not null)
            {
                // The same payment sent twice is the same payment; a different one is a mistake.
                return existing.Amount == request.Amount && existing.Reference == reference
                    ? BillingCommand.Success<PlatformPaymentView>(PlatformBillingReader.ToView(existing, forAdmin: true))
                    : BillingCommand.Conflict<PlatformPaymentView>(
                        "invoice_paid",
                        "A payment is already recorded for this invoice.");
            }

            if (invoice.Total == 0m)
            {
                return BillingCommand.Conflict<PlatformPaymentView>("nothing_to_pay", "This invoice has nothing to pay.");
            }

            if (request.Amount != invoice.Total)
            {
                return BillingCommand.Invalid<PlatformPaymentView>(
                    nameof(request.Amount),
                    $"The payment must be exactly {invoice.Total:0.00} {invoice.CurrencyCode}. Partial payments are not supported yet.");
            }

            var now = clock.UtcNow;
            var payment = PlatformPayment.Record(
                invoice,
                request.Amount,
                reference,
                note,
                request.ReceivedOn ?? PaymentSchedule.Today(now),
                RequiredAdmin(),
                now);
            dbContext.PlatformPayments.Add(payment);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return BillingCommand.Success<PlatformPaymentView>(PlatformBillingReader.ToView(payment, forAdmin: true));
        });
    }

    public async Task<BillingCommandResult<VoidInvoiceResponse>> VoidInvoiceAsync(
        Guid invoiceId,
        VoidInvoiceRequest request,
        CancellationToken cancellationToken)
    {
        var reason = request.Reason?.Trim() ?? string.Empty;
        if (reason.Length is 0 or > 500)
        {
            return BillingCommand.Invalid<VoidInvoiceResponse>(
                nameof(request.Reason),
                "Say why the invoice is voided, in up to 500 characters.");
        }

        if (!await EnterInvoiceWorkspaceAsync(invoiceId, cancellationToken))
        {
            return BillingCommand.NotFound<VoidInvoiceResponse>();
        }

        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await PlatformBillingReader.LockInvoiceAsync(dbContext, invoiceId, cancellationToken);
            var invoice = await dbContext.PlatformInvoices.AsNoTracking().SingleAsync(item => item.Id == invoiceId, cancellationToken);
            if (await dbContext.PlatformInvoiceVoids.AnyAsync(item => item.InvoiceId == invoiceId, cancellationToken))
            {
                return BillingCommand.Conflict<VoidInvoiceResponse>("invoice_void", "This invoice is already void.");
            }

            if (await dbContext.PlatformPayments.AnyAsync(item => item.InvoiceId == invoiceId, cancellationToken))
            {
                return BillingCommand.Conflict<VoidInvoiceResponse>(
                    "invoice_paid",
                    "A paid invoice cannot be voided. Refunds are not supported yet.");
            }

            var now = clock.UtcNow;
            var voided = PlatformInvoiceVoid.Record(invoice, reason, RequiredAdmin(), now);
            dbContext.PlatformInvoiceVoids.Add(voided);

            PlatformInvoice? reissued = null;
            if (request.Reissue)
            {
                // A correction recounts usage and discount now, at the voided invoice's own prices.
                var plan = await dbContext.PlatformPricePlans.AsNoTracking()
                    .SingleAsync(item => item.Id == invoice.PricePlanId, cancellationToken);
                var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, invoice.TenantId, cancellationToken)).Single();
                reissued = await PlatformBillingReader.BuildInvoiceAsync(
                    dbContext,
                    workspace,
                    invoice.Period,
                    new UsageWindow(invoice.UsageFromUtc, invoice.Period.EndUtc),
                    plan,
                    options.Value.ReferencePrefix,
                    now,
                    invoice.Id,
                    cancellationToken);
                dbContext.PlatformInvoices.Add(reissued);
                PlatformInvoiceRun.QueueIssuedNotice(dbContext, workspace, reissued, now);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            var today = PaymentSchedule.Today(now);
            return BillingCommand.Success<VoidInvoiceResponse>(new VoidInvoiceResponse(
                PlatformBillingReader.ToView(new InvoiceFacts(invoice, voided, null, reissued?.Id), today, forAdmin: true),
                reissued is null
                    ? null
                    : PlatformBillingReader.ToView(new InvoiceFacts(reissued, null, null, null), today, forAdmin: true)));
        });
    }

    public async Task<BillingCommandResult<WorkspaceDiscountView>> GrantDiscountAsync(
        Guid tenantId,
        GrantDiscountRequest request,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (request.Percent <= 0m || request.Percent > 100m || decimal.Round(request.Percent, 2) != request.Percent)
        {
            errors[nameof(request.Percent)] = ["Enter a percentage above 0 and up to 100, with at most two decimals."];
        }

        if (request.EndsOnExclusive <= request.StartsOn)
        {
            errors[nameof(request.EndsOnExclusive)] = ["The discount must end after it starts."];
        }

        var note = request.Note?.Trim() ?? string.Empty;
        if (note.Length is 0 or > 200)
        {
            errors[nameof(request.Note)] = ["Say what the discount is for, in up to 200 characters."];
        }

        if (errors.Count > 0)
        {
            return BillingCommand.Invalid<WorkspaceDiscountView>(errors);
        }

        if (!await dbContext.Tenants.AnyAsync(tenant => tenant.Id == tenantId, cancellationToken))
        {
            return BillingCommand.NotFound<WorkspaceDiscountView>();
        }

        tenantContext.SetTenant(tenantId);
        var discount = WorkspaceDiscount.Grant(
            tenantId,
            request.Percent,
            request.StartsOn,
            request.EndsOnExclusive,
            note,
            RequiredAdmin(),
            clock.UtcNow);
        dbContext.WorkspaceDiscounts.Add(discount);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsViolation(exception, PostgresErrorCodes.ExclusionViolation))
        {
            return BillingCommand.Conflict<WorkspaceDiscountView>(
                "discount_overlap",
                "This workspace already has a discount on some of those dates. Revoke it first.");
        }

        return BillingCommand.Success<WorkspaceDiscountView>(PlatformBillingReader.ToView(discount));
    }

    public async Task<BillingCommandResult<WorkspaceDiscountView>> RevokeDiscountAsync(
        Guid discountId,
        CancellationToken cancellationToken)
    {
        var tenantId = await dbContext.WorkspaceDiscounts
            .IgnoreQueryFilters()
            .Where(item => item.Id == discountId)
            .Select(item => (Guid?)item.TenantId)
            .SingleOrDefaultAsync(cancellationToken);
        if (tenantId is null)
        {
            return BillingCommand.NotFound<WorkspaceDiscountView>();
        }

        tenantContext.SetTenant(tenantId.Value);
        var discount = await dbContext.WorkspaceDiscounts.SingleAsync(item => item.Id == discountId, cancellationToken);
        if (discount.IsRevoked)
        {
            return BillingCommand.Conflict<WorkspaceDiscountView>("discount_revoked", "This discount was already revoked.");
        }

        discount.Revoke(RequiredAdmin(), clock.UtcNow);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return BillingCommand.Conflict<WorkspaceDiscountView>("discount_revoked", "This discount was already revoked.");
        }

        return BillingCommand.Success<WorkspaceDiscountView>(PlatformBillingReader.ToView(discount));
    }

    /// <summary>Finds which workspace an invoice belongs to and acts inside it for this request.</summary>
    private async Task<bool> EnterInvoiceWorkspaceAsync(Guid invoiceId, CancellationToken cancellationToken)
    {
        var tenantId = await dbContext.PlatformInvoices
            .IgnoreQueryFilters()
            .Where(item => item.Id == invoiceId)
            .Select(item => (Guid?)item.TenantId)
            .SingleOrDefaultAsync(cancellationToken);
        if (tenantId is null)
        {
            return false;
        }

        tenantContext.SetTenant(tenantId.Value);
        return true;
    }

    private Guid RequiredAdmin() =>
        currentUser.UserId ?? throw new InvalidOperationException("A platform admin operation needs a signed-in admin.");

    private static AdminWorkspaceSummary Summary(WorkspaceBillingState state, DateTimeOffset now) => new(
        state.Workspace.TenantId,
        state.Workspace.Name,
        state.Workspace.OwnerName,
        state.Workspace.OwnerEmail,
        state.Workspace.CreatedAtUtc,
        state.Status,
        state.TrialEndsAtUtc,
        state.CurrentMonth.Amounts.Seats,
        state.CurrentMonth.Amounts.BillableClients,
        state.UnpaidTotal,
        state.CurrentMonth.Amounts.CurrencyCode,
        WorkspaceDiscount.ApplicableTo(state.Discounts, new UsageWindow(now, now.AddTicks(1)))?.Percent ?? 0m);

    private static PricePlanView ToView(PlatformPricePlan plan, bool isCurrent) => new(
        plan.Id,
        plan.VersionNumber,
        plan.CurrencyCode,
        plan.SeatPrice,
        plan.IncludedClientsPerSeat,
        plan.ExtraClientPrice,
        plan.GymFee,
        plan.GymFeeMinimumSeats,
        plan.TrialDays,
        plan.PaymentTermDays,
        plan.GraceDays,
        plan.Note,
        plan.PublishedAtUtc,
        isCurrent);

    private static BillingCommandResult<PricePlanView> PlanChanged() =>
        BillingCommand.Conflict<PricePlanView>(
            "price_plan_changed",
            "A newer price plan was published since this page loaded. Refresh and try again.");

    private static bool IsViolation(DbUpdateException exception, string sqlState) =>
        exception.InnerException is PostgresException postgres && postgres.SqlState == sqlState;
}
