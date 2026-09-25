using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Application;

/// <summary>A workspace as billing sees it.</summary>
internal sealed record BillingWorkspace(
    Guid TenantId,
    string Name,
    string TimeZoneId,
    bool IsActive,
    DateTimeOffset CreatedAtUtc,
    Guid? OwnerUserId,
    string OwnerName,
    string OwnerEmail);

/// <summary>One issued invoice with the append-only facts about it.</summary>
internal sealed record InvoiceFacts(
    PlatformInvoice Invoice,
    PlatformInvoiceVoid? Void,
    PlatformPayment? Payment,
    Guid? ReplacedByInvoiceId);

/// <summary>Everything billing knows about one workspace at one instant.</summary>
internal sealed record WorkspaceBillingState(
    BillingWorkspace Workspace,
    DateTimeOffset TrialEndsAtUtc,
    IReadOnlyList<InvoiceFacts> Invoices,
    IReadOnlyList<WorkspaceDiscount> Discounts,
    CurrentMonthEstimateView CurrentMonth,
    WorkspaceBillingStatus Status,
    decimal UnpaidTotal,
    DateOnly? ReadOnlyFrom);

/// <summary>
/// The reads and the one calculation path platform billing shares between the owner's page, the admin
/// screen and the monthly run (ADR 0028).
/// </summary>
/// <remarks>
/// Every query names its workspace explicitly and ignores the tenant query filter, because the admin
/// screen and the Worker read across workspaces. Each caller is itself authorized for that workspace:
/// the owner by the tenant policy, the admin by the platform-admin policy, the Worker by being the
/// platform.
/// </remarks>
internal static class PlatformBillingReader
{
    public static Task<List<PlatformPricePlan>> PlansAsync(GymDbContext dbContext, CancellationToken cancellationToken) =>
        dbContext.PlatformPricePlans.AsNoTracking().OrderBy(plan => plan.VersionNumber).ToListAsync(cancellationToken);

    public static async Task<List<BillingWorkspace>> WorkspacesAsync(
        GymDbContext dbContext,
        Guid? tenantId,
        CancellationToken cancellationToken)
    {
        var tenants = await dbContext.Tenants
            .AsNoTracking()
            .Where(tenant => tenantId == null || tenant.Id == tenantId)
            .OrderBy(tenant => tenant.Name)
            .Select(tenant => new { tenant.Id, tenant.Name, tenant.TimeZoneId, tenant.IsActive, tenant.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        var ids = tenants.Select(tenant => tenant.Id).ToList();
        var owners = await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
            where ids.Contains(membership.TenantId) &&
                  membership.Role == TenantRole.Owner &&
                  membership.Status == MembershipStatus.Active
            select new { membership.TenantId, user.Id, user.DisplayName, user.Email })
            .ToListAsync(cancellationToken);
        return tenants
            .Select(tenant =>
            {
                var owner = owners.FirstOrDefault(item => item.TenantId == tenant.Id);
                return new BillingWorkspace(
                    tenant.Id,
                    tenant.Name,
                    tenant.TimeZoneId,
                    tenant.IsActive,
                    tenant.CreatedAtUtc,
                    owner?.Id,
                    owner?.DisplayName ?? string.Empty,
                    owner?.Email ?? string.Empty);
            })
            .ToList();
    }

    public static DateTimeOffset TrialEndsAt(BillingWorkspace workspace, IReadOnlyCollection<PlatformPricePlan> plans) =>
        TrialPolicy.EndsAt(workspace.CreatedAtUtc, TrialPolicy.PlanAt(plans, workspace.CreatedAtUtc).TrialDays);

    /// <summary>Seats and billable clients over a window, from membership history, plan coverage and pauses.</summary>
    public static async Task<InvoiceQuantities> CountAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        UsageWindow window,
        CancellationToken cancellationToken)
    {
        var tenantId = workspace.TenantId;
        var changes = await dbContext.MembershipStatusChanges
            .AsNoTracking()
            .Where(change =>
                change.TenantId == tenantId &&
                (change.Role == TenantRole.Owner || change.Role == TenantRole.Coach) &&
                change.ChangedAtUtc < window.End)
            .Select(change => new StaffStatusChange(
                change.MembershipId,
                change.UserId,
                change.Status == MembershipStatus.Active,
                change.ChangedAtUtc))
            .ToListAsync(cancellationToken);

        // A day either side, so a plan whose workspace-local dates touch the window's UTC edges is read;
        // the exact instant comparison happens in the domain rule.
        var fromDate = DateOnly.FromDateTime(window.Start.UtcDateTime).AddDays(-2);
        var toDate = DateOnly.FromDateTime(window.End.UtcDateTime).AddDays(2);
        var enrollments = await (
            from enrollment in dbContext.ClientEnrollments.IgnoreQueryFilters().AsNoTracking()
            join profile in dbContext.ClientProfiles.IgnoreQueryFilters().AsNoTracking()
                on new { enrollment.TenantId, Id = enrollment.ClientProfileId } equals new { profile.TenantId, profile.Id }
            where enrollment.TenantId == tenantId &&
                  enrollment.ActivatedAtUtc != null &&
                  enrollment.ActivatedAtUtc < window.End &&
                  (enrollment.CancelledAtUtc == null || enrollment.CancelledAtUtc > window.Start) &&
                  enrollment.StartDate < toDate &&
                  enrollment.EndDateExclusive > fromDate &&
                  dbContext.EnrollmentEntitlements.IgnoreQueryFilters().Any(entitlement =>
                      entitlement.TenantId == tenantId && entitlement.EnrollmentId == enrollment.Id)
            select new
            {
                enrollment.Id,
                ClientKey = profile.UserId ?? profile.Id,
                enrollment.StartDate,
                enrollment.EndDateExclusive,
                enrollment.ActivatedAtUtc,
                enrollment.CancelledAtUtc,
            })
            .ToListAsync(cancellationToken);
        var enrollmentIds = enrollments.Select(enrollment => enrollment.Id).ToList();
        var pauses = PausePeriod.FromHistory(await dbContext.EnrollmentStatusChanges
            .AsNoTracking()
            .Where(change =>
                change.TenantId == tenantId &&
                enrollmentIds.Contains(change.EnrollmentId) &&
                change.ChangedAtUtc < window.End)
            .Select(change => new EnrollmentStatusStep(
                change.EnrollmentId,
                change.Status == EnrollmentStatus.Paused,
                change.ChangedAtUtc))
            .ToListAsync(cancellationToken));
        var spans = enrollments
            .Select(enrollment => new CoverageSpan(
                enrollment.ClientKey,
                enrollment.StartDate,
                enrollment.EndDateExclusive,
                enrollment.ActivatedAtUtc,
                enrollment.CancelledAtUtc,
                pauses.GetValueOrDefault(enrollment.Id)))
            .ToList();

        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(workspace.TimeZoneId);
        return new InvoiceQuantities(
            Math.Max(1, SeatCounter.Count(changes, window)),
            BillableClientCounter.Count(spans, window, timeZone));
    }

    public static Task<List<WorkspaceDiscount>> DiscountsAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken) =>
        dbContext.WorkspaceDiscounts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(discount => discount.TenantId == tenantId)
            .OrderBy(discount => discount.StartsOn)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Counts usage and prices it: the one path an invoice or a reissue is built through.
    /// </summary>
    public static async Task<PlatformInvoice> BuildInvoiceAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        BillingMonth month,
        UsageWindow window,
        PlatformPricePlan plan,
        string referencePrefix,
        DateTimeOffset now,
        Guid? replacesInvoiceId,
        CancellationToken cancellationToken)
    {
        var quantities = await CountAsync(dbContext, workspace, window, cancellationToken);
        var discount = WorkspaceDiscount.ApplicableTo(
            await DiscountsAsync(dbContext, workspace.TenantId, cancellationToken),
            window);
        var amounts = PlatformInvoiceCalculation.Calculate(plan.Terms, quantities, discount?.Percent ?? 0m);
        return PlatformInvoice.Issue(
            workspace.TenantId,
            month,
            window.Start,
            plan,
            amounts,
            discount?.Id,
            InvoiceReference.Create(referencePrefix, month),
            now,
            replacesInvoiceId);
    }

    public static async Task<List<InvoiceFacts>> InvoicesAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var invoices = await dbContext.PlatformInvoices
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(invoice => invoice.TenantId == tenantId)
            .OrderByDescending(invoice => invoice.PeriodStart)
            .ThenByDescending(invoice => invoice.IssuedAtUtc)
            .ToListAsync(cancellationToken);
        var voids = await dbContext.PlatformInvoiceVoids
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId)
            .ToDictionaryAsync(item => item.InvoiceId, cancellationToken);
        var payments = await dbContext.PlatformPayments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId)
            .ToDictionaryAsync(item => item.InvoiceId, cancellationToken);
        var replacements = invoices
            .Where(invoice => invoice.ReplacesInvoiceId is not null)
            .ToDictionary(invoice => invoice.ReplacesInvoiceId!.Value, invoice => invoice.Id);
        return invoices
            .Select(invoice => new InvoiceFacts(
                invoice,
                voids.GetValueOrDefault(invoice.Id),
                payments.GetValueOrDefault(invoice.Id),
                replacements.TryGetValue(invoice.Id, out var replacement) ? replacement : null))
            .ToList();
    }

    public static async Task<WorkspaceBillingState> StateAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        IReadOnlyList<PlatformPricePlan> plans,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var trialEndsAt = TrialEndsAt(workspace, plans);
        var invoices = await InvoicesAsync(dbContext, workspace.TenantId, cancellationToken);
        var discounts = await DiscountsAsync(dbContext, workspace.TenantId, cancellationToken);
        var estimate = await EstimateAsync(dbContext, workspace, plans, discounts, trialEndsAt, now, cancellationToken);
        var today = PaymentSchedule.Today(now);
        var unpaid = invoices.Where(item => IsUnpaid(item)).ToList();
        var status = PlatformInvoiceStatusPolicy.Workspace(
            unpaid.Any(item => PlatformInvoiceStatusPolicy.LocksWorkspace(item.Invoice.Total, item.Invoice.ReadOnlyFrom, false, false, today)),
            unpaid.Any(item => today > item.Invoice.DueOn),
            now < trialEndsAt);
        return new WorkspaceBillingState(
            workspace,
            trialEndsAt,
            invoices,
            discounts,
            estimate,
            status,
            unpaid.Sum(item => item.Invoice.Total),
            unpaid.Count == 0 ? null : unpaid.Min(item => item.Invoice.ReadOnlyFrom));
    }

    public static bool IsUnpaid(InvoiceFacts facts) =>
        facts.Void is null && facts.Payment is null && facts.Invoice.Total > 0m;

    /// <summary>
    /// This month so far, priced with the latest plan. While the whole of it is inside the trial, the
    /// counts are shown and nothing is charged.
    /// </summary>
    private static async Task<CurrentMonthEstimateView> EstimateAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        IReadOnlyList<PlatformPricePlan> plans,
        IReadOnlyList<WorkspaceDiscount> discounts,
        DateTimeOffset trialEndsAt,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var month = BillingMonth.Containing(now);
        var plan = plans.MaxBy(item => item.VersionNumber)!;
        var window = TrialPolicy.BillableWindow(month, trialEndsAt, now);
        if (window.IsEmpty)
        {
            var soFar = new UsageWindow(month.StartUtc, now > month.StartUtc ? now : month.StartUtc.AddTicks(1));
            var counted = await CountAsync(dbContext, workspace, soFar, cancellationToken);
            return new CurrentMonthEstimateView(
                month.Start,
                month.EndExclusive,
                soFar.Start,
                soFar.End,
                true,
                plan.VersionNumber,
                new BillingAmountsView(counted.Seats, counted.BillableClients, 0, 0, 0m, 0m, 0m, 0m, 0m, 0m, 0m, plan.CurrencyCode));
        }

        var quantities = await CountAsync(dbContext, workspace, window, cancellationToken);
        var discount = WorkspaceDiscount.ApplicableTo(discounts, new UsageWindow(window.Start, month.EndUtc));
        var amounts = PlatformInvoiceCalculation.Calculate(plan.Terms, quantities, discount?.Percent ?? 0m);
        return new CurrentMonthEstimateView(
            month.Start,
            month.EndExclusive,
            window.Start,
            window.End,
            false,
            plan.VersionNumber,
            ToView(amounts, plan.CurrencyCode));
    }

    public static BillingAmountsView ToView(InvoiceAmounts amounts, string currencyCode) => new(
        amounts.Seats,
        amounts.BillableClients,
        amounts.IncludedClients,
        amounts.ExtraClients,
        amounts.SeatAmount,
        amounts.ExtraClientAmount,
        amounts.GymFeeAmount,
        amounts.Subtotal,
        amounts.DiscountPercent,
        amounts.DiscountAmount,
        amounts.Total,
        currencyCode);

    public static PlatformInvoiceView ToView(InvoiceFacts facts, DateOnly today, bool forAdmin)
    {
        var invoice = facts.Invoice;
        var isVoid = facts.Void is not null;
        var isPaid = facts.Payment is not null;
        return new PlatformInvoiceView(
            invoice.Id,
            invoice.ReferenceCode,
            invoice.PeriodStart,
            invoice.PeriodEndExclusive,
            invoice.UsageFromUtc,
            invoice.IssuedAtUtc,
            invoice.DueOn,
            invoice.ReadOnlyFrom,
            invoice.PricePlanVersion,
            invoice.CalculationName,
            invoice.PlanSeatPrice,
            invoice.PlanIncludedClientsPerSeat,
            invoice.PlanExtraClientPrice,
            invoice.PlanGymFee,
            invoice.PlanGymFeeMinimumSeats,
            new BillingAmountsView(
                invoice.Seats,
                invoice.BillableClients,
                invoice.IncludedClients,
                invoice.ExtraClients,
                invoice.SeatAmount,
                invoice.ExtraClientAmount,
                invoice.GymFeeAmount,
                invoice.Subtotal,
                invoice.DiscountPercent,
                invoice.DiscountAmount,
                invoice.Total,
                invoice.CurrencyCode),
            PlatformInvoiceStatusPolicy.Evaluate(invoice.Total, invoice.DueOn, isVoid, isPaid, today),
            PlatformInvoiceStatusPolicy.LocksWorkspace(invoice.Total, invoice.ReadOnlyFrom, isVoid, isPaid, today),
            facts.Payment is { } payment ? ToView(payment, forAdmin) : null,
            facts.Void?.VoidedAtUtc,
            facts.Void?.Reason,
            invoice.ReplacesInvoiceId,
            facts.ReplacedByInvoiceId);
    }

    /// <summary>The admin's own note stays on the admin screen; the owner sees the payment itself.</summary>
    public static PlatformPaymentView ToView(PlatformPayment payment, bool forAdmin) => new(
        payment.Id,
        payment.InvoiceId,
        payment.Amount,
        payment.CurrencyCode,
        payment.Reference,
        forAdmin ? payment.Note : null,
        payment.ReceivedOn,
        payment.RecordedAtUtc);

    public static WorkspaceDiscountView ToView(WorkspaceDiscount discount) => new(
        discount.Id,
        discount.Percent,
        discount.StartsOn,
        discount.EndsOnExclusive,
        discount.Note,
        discount.GrantedAtUtc,
        discount.RevokedAtUtc);

    public static Task LockInvoiceAsync(GymDbContext dbContext, Guid invoiceId, CancellationToken cancellationToken) =>
        dbContext.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM billing."Invoices" WHERE "Id" = {invoiceId} FOR UPDATE /* platform-billing */""",
            cancellationToken);
}
