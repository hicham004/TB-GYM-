using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>The owner's Billing page and the coach app's read-only banner (ADR 0028).</summary>
internal sealed class WorkspaceBillingService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IOptions<PlatformBillingOptions> options)
    : IWorkspaceBillingService
{
    public async Task<WorkspaceBillingView> GetForOwnerAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var plans = await PlatformBillingReader.PlansAsync(dbContext, cancellationToken);
        var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantContext.TenantId, cancellationToken)).Single();
        var state = await PlatformBillingReader.StateAsync(dbContext, workspace, plans, now, cancellationToken);
        var today = PaymentSchedule.Today(now);
        return new WorkspaceBillingView(
            state.Status,
            state.TrialEndsAtUtc,
            state.CurrentMonth,
            state.Invoices.Select(item => PlatformBillingReader.ToView(item, today, forAdmin: false)).ToList(),
            state.UnpaidTotal,
            state.CurrentMonth.Amounts.CurrencyCode,
            state.ReadOnlyFrom,
            new PaymentInstructionsView(string.IsNullOrWhiteSpace(options.Value.WhishNumber) ? null : options.Value.WhishNumber.Trim()));
    }

    public async Task<WorkspaceBillingAccessView> GetAccessAsync(CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        var today = PaymentSchedule.Today(clock.UtcNow);
        var unpaid = await WorkspaceBillingLock.UnpaidInvoices(dbContext, tenantId)
            .Select(invoice => new { invoice.DueOn, invoice.ReadOnlyFrom })
            .ToListAsync(cancellationToken);
        var isReadOnly = unpaid.Any(invoice => invoice.ReadOnlyFrom <= today);
        var isOwner = await dbContext.TenantMemberships.AnyAsync(
            membership =>
                membership.TenantId == tenantId &&
                membership.UserId == currentUser.UserId &&
                membership.Role == TenantRole.Owner &&
                membership.Status == MembershipStatus.Active,
            cancellationToken);

        // A coach learns only that the workspace is read-only; the bill itself is the owner's.
        return isOwner
            ? new WorkspaceBillingAccessView(
                isReadOnly,
                unpaid.Any(invoice => today > invoice.DueOn),
                unpaid.Count == 0 ? null : unpaid.Min(invoice => invoice.ReadOnlyFrom))
            : new WorkspaceBillingAccessView(isReadOnly, false, null);
    }
}

/// <summary>
/// Whether an unpaid invoice has made a workspace read-only for its staff. The tenant authorization
/// handler asks this for every state-changing request an owner or coach makes (ADR 0028).
/// </summary>
internal sealed class WorkspaceBillingLock(GymDbContext dbContext, IClock clock)
{
    public Task<bool> IsReadOnlyAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var today = PaymentSchedule.Today(clock.UtcNow);
        return UnpaidInvoices(dbContext, tenantId).AnyAsync(invoice => invoice.ReadOnlyFrom <= today, cancellationToken);
    }

    /// <summary>
    /// Issued, owing money, and neither voided nor paid: the same rule as
    /// <see cref="PlatformInvoiceStatusPolicy.LocksWorkspace"/>, written as one query.
    /// </summary>
    public static IQueryable<PlatformInvoice> UnpaidInvoices(GymDbContext dbContext, Guid tenantId) =>
        dbContext.PlatformInvoices
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(invoice =>
                invoice.TenantId == tenantId &&
                invoice.Total > 0m &&
                !dbContext.PlatformInvoiceVoids.IgnoreQueryFilters().Any(item =>
                    item.TenantId == tenantId && item.InvoiceId == invoice.Id) &&
                !dbContext.PlatformPayments.IgnoreQueryFilters().Any(item =>
                    item.TenantId == tenantId && item.InvoiceId == invoice.Id));
}
